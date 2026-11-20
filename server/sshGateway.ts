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
      type: 'writeFile';
      requestId?: unknown;
      path?: unknown;
      content?: unknown;
    }
  | {
      type: 'createDir';
      requestId?: unknown;
      path?: unknown;
    }
  | {
      type: 'gitCommand';
      requestId?: unknown;
      cwd?: unknown;
      action?: unknown;
      payload?: unknown;
    }
  | {
      type: 'disconnect';
    }
  | {
      type: 'ping';
    };

function quoteShellArg(arg: string): string {
  return `'${arg.replace(/'/g, `'"'"'`)}'`;
}

function isSafeRepoRelativePath(p: string): boolean {
  if (!p || p.includes('\0')) return false;
  if (p.startsWith('/')) return false;
  const parts = p.split('/');
  return !parts.some((seg) => seg === '..');
}

function sanitizeBranchName(name: string): string {
  return name.trim().replace(/[\s\0~^:?*[\\]+/g, '-');
}

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
    let fileClient: SshClient | null = null;
    let fileClientPromise: Promise<SshClient> | null = null;
    let activeConnectConfig: ConnectConfig | null = null;
    let activeAuthType: string = 'password';
    let activePassword = '';
    let shellStream: ClientChannel | null = null;
    let sftpSession: SFTPWrapper | null = null;
    let sftpInitPromise: Promise<SFTPWrapper> | null = null;
    let sftpFailedPermanently = false;
    let currentCols = 100;
    let currentRows = 30;
    let manualDisconnect = false;
    let execQueue: Promise<unknown> = Promise.resolve();

    const cleanupSsh = (reason?: string, notifyDisconnect = false) => {
      sftpInitPromise = null;
      sftpFailedPermanently = false;
      fileClientPromise = null;
      activeConnectConfig = null;
      if (sftpSession) {
        try {
          sftpSession.end();
        } catch {
          // ignore sftp cleanup errors
        }
        sftpSession = null;
      }
      if (fileClient) {
        try {
          fileClient.removeAllListeners();
          fileClient.end();
        } catch {
          // ignore fileClient cleanup errors
        }
        fileClient = null;
      }
      if (shellStream) {
        try {
          shellStream.write('\x03exit\n');
        } catch {
          // ignore write error
        }
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

    const normalizePosixClean = (p: string): string => {
      const n = path.posix.normalize(p || '/');
      return n.length > 1 && n.endsWith('/') ? n.slice(0, -1) : n;
    };

    const getFileClient = async (): Promise<SshClient> => {
      if (!sshClient) {
        throw new Error('SSH is not connected.');
      }
      if (fileClient) {
        return fileClient;
      }
      if (!activeConnectConfig) {
        return sshClient;
      }
      if (fileClientPromise) {
        return fileClientPromise;
      }

      const mainClientRef = sshClient;
      const cfg = { ...activeConnectConfig, readyTimeout: 12000 };
      const authMode = activeAuthType;
      const pass = activePassword;

      fileClientPromise = new Promise<SshClient>((resolve) => {
        let settled = false;
        let fc: SshClient | null = null;
        const finishFallback = () => {
          if (settled) return;
          settled = true;
          fileClientPromise = null;
          if (fc) {
            try {
              fc.removeAllListeners();
              fc.end();
            } catch {
              // ignore
            }
          }
          resolve(sshClient || mainClientRef);
        };

        try {
          fc = new SshClient();

          fc.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
            if (authMode === 'password' && prompts.length > 0) {
              finish(prompts.map(() => pass));
            } else {
              finish([]);
            }
          });

          fc.on('ready', () => {
            if (settled || !fc) return;
            if (sshClient !== mainClientRef) {
              finishFallback();
              return;
            }
            settled = true;
            fileClient = fc;
            fileClientPromise = null;
            fc.on('close', () => {
              if (fileClient === fc) {
                fileClient = null;
                sftpSession = null;
              }
            });
            resolve(fc);
          });

          fc.on('error', finishFallback);
          fc.on('close', finishFallback);
          fc.connect(cfg);
        } catch {
          finishFallback();
        }
      });

      return fileClientPromise;
    };

    const getSftp = async (): Promise<SFTPWrapper> => {
      if (sftpFailedPermanently) {
        throw new Error('SFTP subsystem unavailable on remote server.');
      }
      if (sftpSession) {
        return sftpSession;
      }
      if (sftpInitPromise) {
        return sftpInitPromise;
      }

      const clientRef = await getFileClient();
      sftpInitPromise = new Promise<SFTPWrapper>((resolve, reject) => {
        clientRef.sftp((err, sftp) => {
          sftpInitPromise = null;
          if (err || !sftp) {
            sftpFailedPermanently = true;
            reject(err || new Error('SFTP subsystem unavailable on remote server.'));
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
      new Promise((resolve) => {
        const trimmed = (rawPath || '').trim();
        if (!trimmed || trimmed === '~') {
          sftp.realpath('.', (err, absPath) => {
            if (!err && absPath) resolve(normalizePosixClean(absPath));
            else resolve('/');
          });
          return;
        }
        if (trimmed.startsWith('~/')) {
          sftp.realpath('.', (homeErr, homePath) => {
            const home = !homeErr && homePath ? normalizePosixClean(homePath) : '/';
            const joined = path.posix.join(home, trimmed.slice(2));
            sftp.realpath(joined, (err, absPath) => {
              if (!err && absPath) resolve(normalizePosixClean(absPath));
              else resolve(normalizePosixClean(joined));
            });
          });
          return;
        }
        if (trimmed.startsWith('/')) {
          const norm = normalizePosixClean(trimmed);
          sftp.realpath(norm, (err, absPath) => {
            if (!err && absPath) resolve(normalizePosixClean(absPath));
            else resolve(norm);
          });
          return;
        }
        sftp.realpath(trimmed, (err, absPath) => {
          if (!err && absPath) resolve(normalizePosixClean(absPath));
          else resolve(normalizePosixClean(trimmed));
        });
      });

    const execViaShellChannel = (
      client: SshClient,
      cmd: string,
      timeoutMs = 25000
    ): Promise<{ stdout: string; stderr: string; code: number }> =>
      new Promise((resolve, reject) => {
        client.shell({ term: 'dumb', cols: 220, rows: 40 }, (err, stream) => {
          if (err || !stream) {
            reject(err || new Error('Failed to open shell channel.'));
            return;
          }
          const marker = `__NC_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const startTag = `${marker}_START`;
          const endTag = `${marker}_END:`;
          let rawOutput = '';
          let settled = false;
          const MAX_OUTPUT = 2 * 1024 * 1024;

          const finishWithOutput = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try {
              stream.close();
            } catch {
              // ignore
            }
            const startIdx = rawOutput.indexOf(startTag);
            const afterStart =
              startIdx === -1 ? rawOutput : rawOutput.slice(startIdx + startTag.length);
            const endIdx = afterStart.lastIndexOf(endTag);
            if (endIdx === -1) {
              resolve({ stdout: afterStart.trim(), stderr: '', code: 0 });
              return;
            }
            const body = afterStart.slice(0, endIdx).replace(/^\r?\n/, '').replace(/\r?\n$/, '');
            const exitLine = afterStart.slice(endIdx + endTag.length).trim().split(/\s+/)[0] || '0';
            const code = Number.parseInt(exitLine, 10);
            resolve({
              stdout: body.replace(/\r\n/g, '\n'),
              stderr: '',
              code: Number.isFinite(code) ? code : 0,
            });
          };

          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            try {
              stream.close();
            } catch {
              // ignore
            }
            reject(new Error('Remote command timed out.'));
          }, timeoutMs);

          stream.on('data', (chunk: Buffer) => {
            if (rawOutput.length < MAX_OUTPUT) {
              rawOutput += chunk.toString('utf8');
            }
            const sIdx = rawOutput.indexOf(startTag);
            if (sIdx !== -1) {
              const eIdx = rawOutput.indexOf(endTag, sIdx + startTag.length);
              if (eIdx !== -1 && rawOutput.indexOf('\n', eIdx) !== -1) {
                finishWithOutput();
              }
            }
          });
          stream.on('close', finishWithOutput);
          stream.on('error', (streamErr: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(streamErr);
          });

          const cmdB64 = Buffer.from(cmd, 'utf8').toString('base64');
          const wrapped = [
            `stty -echo 2>/dev/null || true`,
            `printf '\\n%s\\n' ${quoteShellArg(startTag)}`,
            `eval "$(printf '%s' ${quoteShellArg(cmdB64)} | base64 -d 2>/dev/null || printf '%s' ${quoteShellArg(cmdB64)} | python3 -c 'import sys,base64;sys.stdout.write(base64.b64decode(sys.stdin.read()).decode())')"`,
            `printf '\\n%s%d\\n' ${quoteShellArg(endTag)} $?`,
            `exit`,
          ].join('\n');
          stream.write(`${wrapped}\n`);
        });
      });

    const execOnSsh = (
      cmd: string,
      timeoutMs = 25000
    ): Promise<{ stdout: string; stderr: string; code: number }> => {
      const execute = async () => {
        const client = await getFileClient();
        return new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
          let retryCount = 0;

          const attempt = () => {
            if (!sshClient) {
              reject(new Error('SSH is not connected.'));
              return;
            }
            client.exec(cmd, (err, stream) => {
              if (err) {
                const isChanFailure = Boolean(err.message?.includes('Channel open failure'));
                if (isChanFailure && retryCount === 0) {
                  retryCount += 1;
                  // If an open SFTP session is occupying MaxSessions=1 on fileClient, close it and retry exec
                  if (sftpSession) {
                    try {
                      sftpSession.end();
                    } catch {
                      // ignore
                    }
                    sftpSession = null;
                    sftpFailedPermanently = true;
                  }
                  setTimeout(attempt, 200);
                  return;
                }
                if (isChanFailure && client !== sshClient) {
                  // Server may restrict 'exec' channels on fileClient while allowing 'shell' channels
                  execViaShellChannel(client, cmd, timeoutMs).then(resolve).catch(() => reject(err));
                  return;
                }
                reject(err);
                return;
              }

              let stdout = '';
              let stderr = '';
              let settled = false;
              const MAX_OUTPUT = 2 * 1024 * 1024;
              const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                try {
                  stream.close();
                } catch {
                  // ignore
                }
                reject(new Error('Remote command timed out.'));
              }, timeoutMs);

              stream.on('data', (chunk: Buffer) => {
                if (stdout.length < MAX_OUTPUT) {
                  stdout += chunk.toString('utf8');
                }
              });
              stream.stderr?.on('data', (chunk: Buffer) => {
                if (stderr.length < MAX_OUTPUT) {
                  stderr += chunk.toString('utf8');
                }
              });
              stream.on('close', (code: number | null) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve({ stdout, stderr, code: typeof code === 'number' ? code : 0 });
              });
              stream.on('error', (streamErr: Error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(streamErr);
              });
            });
          };

          attempt();
        });
      };

      const result = execQueue.then(execute, execute);
      execQueue = result.catch(() => {});
      return result;
    };

    const resolvePathShell = async (rawPath?: string): Promise<string> => {
      const trimmed = (rawPath || '').trim();
      if (!trimmed || trimmed === '~') {
        const res = await execOnSsh(`sh -c 'cd ~ 2>/dev/null && pwd || echo "/"'`, 8000);
        const out = res.stdout.trim().split('\n')[0];
        return out ? normalizePosixClean(out) : '/';
      }
      if (trimmed.startsWith('/') && !trimmed.includes('..') && !trimmed.includes('~')) {
        return normalizePosixClean(trimmed);
      }
      if (trimmed.startsWith('~/')) {
        const homeRes = await execOnSsh(`sh -c 'cd ~ 2>/dev/null && pwd || echo "/"'`, 8000);
        const home = homeRes.stdout.trim().split('\n')[0] || '/';
        return normalizePosixClean(path.posix.join(home, trimmed.slice(2)));
      }
      const qPath = quoteShellArg(trimmed);
      const res = await execOnSsh(`sh -c 'cd ${qPath} 2>/dev/null && pwd || echo ${qPath}'`, 8000);
      const out = res.stdout.trim().split('\n')[0];
      return normalizePosixClean(out || trimmed);
    };

    const resolveAndListDirShell = async (rawPath?: string) => {
      const rawTrimmed = (rawPath || '').trim() || '~';
      const pathB64 = Buffer.from(rawTrimmed, 'utf8').toString('base64');
      const pyScript = [
        `import os, json, stat, base64`,
        `raw = base64.b64decode('${pathB64}').decode('utf-8').strip()`,
        `p = os.path.abspath(os.path.expanduser(raw or '~'))`,
        `try:`,
        `    if not os.path.exists(p):`,
        `        print(json.dumps({'error': f'Directory not found: {p}'}))`,
        `    elif not os.path.isdir(p):`,
        `        print(json.dumps({'error': f'Not a directory: {p}'}))`,
        `    else:`,
        `        entries = []`,
        `        names = os.listdir(p)`,
        `        for name in names:`,
        `            if name == '.' or name == '..': continue`,
        `            fp = os.path.join(p, name)`,
        `            try:`,
        `                st = os.lstat(fp)`,
        `                is_sym = stat.S_ISLNK(st.st_mode)`,
        `                is_dir = stat.S_ISDIR(st.st_mode)`,
        `                if is_sym:`,
        `                    try: is_dir = os.path.isdir(fp)`,
        `                    except: pass`,
        `                entries.append({'name': name, 'path': fp, 'isDirectory': is_dir, 'size': st.st_size if not is_dir else 0, 'modifiedAt': int(st.st_mtime * 1000)})`,
        `            except: pass`,
        `        entries.sort(key=lambda x: (not x['isDirectory'], x['name'].lower()))`,
        `        print(json.dumps({'path': p, 'entries': entries[:300], 'truncated': len(entries) > 300}))`,
        `except Exception as e:`,
        `    print(json.dumps({'error': str(e)}))`,
      ].join('\n');

      let posixTargetExpr: string;
      if (rawTrimmed === '~') {
        posixTargetExpr = `"$HOME"`;
      } else if (rawTrimmed.startsWith('~/')) {
        posixTargetExpr = `"$HOME/${rawTrimmed.slice(2).replace(/(["\\$`])/g, '\\$1')}"`;
      } else {
        posixTargetExpr = quoteShellArg(rawTrimmed);
      }

      const combinedScript = [
        `if command -v python3 >/dev/null 2>&1; then`,
        `  python3 -c ${quoteShellArg(pyScript)}`,
        `else`,
        `  cd ${posixTargetExpr} || exit 1`,
        `  PWD_VAL=$(pwd)`,
        `  printf '__NC_PWD__:%s\\n' "$PWD_VAL"`,
        `  ls -1ap`,
        `fi`,
      ].join('\n');

      const res = await execOnSsh(`sh -c ${quoteShellArg(combinedScript)}`, 15000);
      const out = res.stdout.trim();

      if (out.startsWith('{')) {
        const parsed = JSON.parse(out) as {
          error?: string;
          path?: string;
          entries?: Array<{
            name: string;
            path: string;
            isDirectory: boolean;
            size: number;
            modifiedAt: number | null;
          }>;
          truncated?: boolean;
        };
        if (parsed.error) {
          throw new Error(parsed.error);
        }
        return {
          path: normalizePosixClean(parsed.path || rawTrimmed),
          entries: Array.isArray(parsed.entries) ? parsed.entries : [],
          truncated: Boolean(parsed.truncated),
        };
      }

      if (res.code !== 0) {
        throw new Error(res.stderr.trim() || `Cannot access directory: ${rawTrimmed}`);
      }

      const lines = res.stdout.split('\n');
      let resolvedPath = rawTrimmed;
      const entryLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith('__NC_PWD__:')) {
          resolvedPath = normalizePosixClean(line.slice('__NC_PWD__:'.length).trim() || rawTrimmed);
        } else {
          const clean = line.trim();
          if (clean && clean !== './' && clean !== '../') {
            entryLines.push(clean);
          }
        }
      }

      const entries = entryLines.slice(0, 300).map((line) => {
        const isDirectory = line.endsWith('/');
        const name = isDirectory ? line.slice(0, -1) : line;
        return {
          name,
          path: path.posix.join(resolvedPath, name),
          isDirectory,
          size: 0,
          modifiedAt: null,
        };
      });

      entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return {
        path: resolvedPath,
        entries,
        truncated: entryLines.length > 300,
      };
    };

    const readFileShell = async (resolvedPath: string) => {
      // 1. Try python3 first
      try {
        const pathB64 = Buffer.from(resolvedPath, 'utf8').toString('base64');
        const pyScript = [
          `import os, sys, base64, json`,
          `p = base64.b64decode('${pathB64}').decode('utf-8')`,
          `try:`,
          `    st = os.stat(p)`,
          `    if os.path.isdir(p):`,
          `        print(json.dumps({'error': 'Selected path is a directory.'}))`,
          `        sys.exit(0)`,
          `    size = st.st_size`,
          `    MAX = 524288`,
          `    with open(p, 'rb') as f:`,
          `        data = f.read(MAX)`,
          `    is_bin = b'\\x00' in data[:1024]`,
          `    b64 = base64.b64encode(data).decode('utf-8')`,
          `    print(json.dumps({'size': size, 'isBinary': is_bin, 'content': b64 if not is_bin else '', 'truncated': size > MAX}))`,
          `except Exception as e:`,
          `    print(json.dumps({'error': str(e)}))`
        ].join('\n');
        const res = await execOnSsh(`python3 -c ${quoteShellArg(pyScript)}`, 15000);
        if (res.code === 0 && res.stdout.trim().startsWith('{')) {
          const parsed = JSON.parse(res.stdout.trim());
          if (parsed.error) throw new Error(parsed.error);
          const contentBuf = Buffer.from(parsed.content || '', 'base64');
          return {
            size: parsed.size,
            isBinary: parsed.isBinary,
            truncated: parsed.truncated,
            content: contentBuf.toString('utf8'),
          };
        }
      } catch (err) {
        if (err instanceof Error && err.message === 'Selected path is a directory.') {
          throw err;
        }
      }

      // 2. POSIX head / base64 fallback
      const qPath = quoteShellArg(resolvedPath);
      const res = await execOnSsh(
        `sh -c 'if [ -d ${qPath} ]; then echo "__DIR__"; exit 0; fi; head -c 524288 ${qPath} | base64'`,
        15000
      );
      if (res.stdout.trim() === '__DIR__') {
        throw new Error('Selected path is a directory.');
      }
      if (res.code !== 0) {
        throw new Error(res.stderr.trim() || `Cannot read file: ${resolvedPath}`);
      }
      const rawB64 = res.stdout.replace(/\s+/g, '');
      const buf = Buffer.from(rawB64, 'base64');
      const isBin = buf.subarray(0, 1024).includes(0);
      return {
        size: buf.length,
        isBinary: isBin,
        truncated: false,
        content: isBin ? '' : buf.toString('utf8'),
      };
    };

    const writeFileShell = async (resolvedPath: string, content: string) => {
      const buf = Buffer.from(content, 'utf8');
      const b64 = buf.toString('base64');
      const pathB64 = Buffer.from(resolvedPath, 'utf8').toString('base64');
      // Try python3 first
      try {
        const script = [
          `import os, base64`,
          `p = base64.b64decode('${pathB64}').decode('utf-8')`,
          `d = os.path.dirname(p)`,
          `if d: os.makedirs(d, exist_ok=True)`,
          `data = base64.b64decode('${b64}')`,
          `with open(p, 'wb') as f:`,
          `    f.write(data)`,
          `print('OK')`
        ].join('\n');
        const res = await execOnSsh(`python3 -c ${quoteShellArg(script)}`, 15000);
        if (res.code === 0 && res.stdout.includes('OK')) {
          return;
        }
      } catch {
        // Fall through
      }

      // POSIX fallback
      const dir = path.posix.dirname(resolvedPath);
      const qDir = quoteShellArg(dir);
      const qFile = quoteShellArg(resolvedPath);
      const script = `mkdir -p ${qDir} && echo '${b64}' | base64 -d > ${qFile}`;
      const resPosix = await execOnSsh(`sh -c ${quoteShellArg(script)}`, 15000);
      if (resPosix.code !== 0) {
        throw new Error(resPosix.stderr.trim() || 'Failed to save file.');
      }
    };

    const createDirShell = async (resolvedPath: string) => {
      const res = await execOnSsh(`mkdir -p ${quoteShellArg(resolvedPath)}`, 10000);
      if (res.code !== 0) {
        throw new Error(res.stderr.trim() || 'Failed to create directory.');
      }
    };

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
            let resolvedPath = '';
            let resolvedEntries: any[] = [];
            let truncated = false;
            try {
              const sftp = await getSftp();
              resolvedPath = await resolveSftpPath(sftp, requestedPath);
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

              resolvedEntries = await Promise.all(
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
              truncated = filtered.length > 300;
              resolvedEntries = resolvedEntries.slice(0, 300);
            } catch (sftpErr) {
              const shellRes = await resolveAndListDirShell(requestedPath);
              resolvedPath = shellRes.path;
              resolvedEntries = shellRes.entries;
              truncated = shellRes.truncated;
            }

            sendJson(ws, {
              type: 'dirListing',
              requestId,
              path: resolvedPath,
              entries: resolvedEntries,
              truncated,
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
            let resolvedPath = '';
            let size = 0;
            let isBinary = false;
            let truncated = false;
            let content = '';

            try {
              const sftp = await getSftp();
              resolvedPath = await resolveSftpPath(sftp, requestedPath);
              const stats = await new Promise<{ size: number; mode: number }>((resolve, reject) => {
                sftp.stat(resolvedPath, (err, st) => {
                  if (err || !st) reject(err || new Error('Unable to read file metadata.'));
                  else resolve({ size: st.size, mode: st.mode });
                });
              });
              if ((stats.mode & 0o170000) === 0o040000) {
                throw new Error('Selected path is a directory.');
              }
              size = stats.size;
              if (size > 0) {
                const MAX_BYTES = 524288;
                const buffer = await new Promise<Buffer>((resolve, reject) => {
                  const chunks: Buffer[] = [];
                  let total = 0;
                  const stream = sftp.createReadStream(resolvedPath, {
                    start: 0,
                    end: Math.min(size, MAX_BYTES) - 1,
                  });
                  stream.on('data', (chunk: Buffer) => {
                    chunks.push(chunk);
                    total += chunk.length;
                  });
                  stream.on('error', (err: Error) => reject(err));
                  stream.on('end', () => resolve(Buffer.concat(chunks, total)));
                });
                isBinary = buffer.subarray(0, 1024).includes(0);
                truncated = size > MAX_BYTES;
                content = isBinary ? '' : buffer.toString('utf8');
              }
            } catch (sftpErr) {
              resolvedPath = await resolvePathShell(requestedPath);
              const resShell = await readFileShell(resolvedPath);
              size = resShell.size;
              isBinary = resShell.isBinary;
              truncated = resShell.truncated;
              content = resShell.content;
            }

            sendJson(ws, {
              type: 'fileContent',
              requestId,
              path: resolvedPath,
              name: path.posix.basename(resolvedPath),
              size,
              truncated,
              isBinary,
              content,
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

      if (msg.type === 'writeFile') {
        const requestId = typeof msg.requestId === 'string' ? msg.requestId : '';
        const requestedPath = typeof msg.path === 'string' ? msg.path.trim() : '';
        const content = typeof msg.content === 'string' ? msg.content : null;
        void (async () => {
          try {
            if (!requestedPath) {
              throw new Error('Missing target file path.');
            }
            if (content === null) {
              throw new Error('Missing file content.');
            }
            const buf = Buffer.from(content, 'utf8');
            if (buf.length > 2 * 1024 * 1024) {
              throw new Error('File content exceeds 2 MB save limit.');
            }

            let targetPath = '';
            try {
              const sftp = await getSftp();
              const ensureDirRecursive = async (dirPath: string): Promise<string> => {
                let clean = dirPath.trim();
                if (!clean || clean === '~') {
                  return resolveSftpPath(sftp, '~');
                }
                if (clean.startsWith('~/')) {
                  const home = await resolveSftpPath(sftp, '~');
                  clean = path.posix.join(home, clean.slice(2));
                }
                const normalized = path.posix.normalize(clean);
                const segments = normalized.split('/').filter(Boolean);
                let current = normalized.startsWith('/') ? '/' : '';
                for (const seg of segments) {
                  current = current === '/' ? `/${seg}` : current ? `${current}/${seg}` : seg;
                  const exists = await new Promise<'dir' | 'file' | 'none'>((resolve) => {
                    sftp.stat(current, (err, st) => {
                      if (err || !st) resolve('none');
                      else resolve((st.mode & 0o170000) === 0o040000 ? 'dir' : 'file');
                    });
                  });
                  if (exists === 'file') {
                    throw new Error(`Path exists as a file, not a directory: ${current}`);
                  }
                  if (exists === 'none') {
                    await new Promise<void>((resolve, reject) => {
                      sftp.mkdir(current, (mkErr) => {
                        if (!mkErr) {
                          resolve();
                          return;
                        }
                        sftp.stat(current, (stErr, st) => {
                          if (!stErr && st && (st.mode & 0o170000) === 0o040000) {
                            resolve();
                          } else {
                            reject(mkErr);
                          }
                        });
                      });
                    });
                  }
                }
                return current || '/';
              };

              try {
                targetPath = await resolveSftpPath(sftp, requestedPath);
                const existingStats = await new Promise<{ mode: number }>((resolve, reject) => {
                  sftp.stat(targetPath, (err, st) => {
                    if (err || !st) reject(err || new Error('Stat failed.'));
                    else resolve({ mode: st.mode });
                  });
                });
                if ((existingStats.mode & 0o170000) === 0o040000) {
                  throw new Error('Cannot overwrite a directory.');
                }
              } catch (err) {
                if (err instanceof Error && err.message === 'Cannot overwrite a directory.') {
                  throw err;
                }
                const baseName = path.posix.basename(requestedPath);
                const dirPart = path.posix.dirname(requestedPath);
                if (!baseName || baseName === '.' || baseName === '..') {
                  throw new Error('Invalid file name.');
                }
                const resolvedParent = await ensureDirRecursive(dirPart === '.' ? '~' : dirPart);
                targetPath = path.posix.join(resolvedParent, baseName);
              }

              await new Promise<void>((resolve, reject) => {
                sftp.writeFile(targetPath, buf, (err) => {
                  if (err) reject(err);
                  else resolve();
                });
              });
            } catch (sftpErr) {
              targetPath = await resolvePathShell(requestedPath);
              await writeFileShell(targetPath, content);
            }

            sendJson(ws, {
              type: 'writeFileResult',
              requestId,
              path: targetPath,
              size: buf.length,
              savedAt: Date.now(),
            });
          } catch (err) {
            sendJson(ws, {
              type: 'writeFileError',
              requestId,
              error: err instanceof Error ? err.message : 'Unable to save remote file.',
            });
          }
        })();
        return;
      }

      if (msg.type === 'createDir') {
        const requestId = typeof msg.requestId === 'string' ? msg.requestId : '';
        const requestedPath = typeof msg.path === 'string' ? msg.path.trim() : '';
        void (async () => {
          try {
            if (!requestedPath) {
              throw new Error('Missing directory path.');
            }
            let resolvedDir = '';
            try {
              const sftp = await getSftp();
              let clean = requestedPath;
              if (clean === '~' || clean.startsWith('~/')) {
                const home = await resolveSftpPath(sftp, '~');
                clean = clean === '~' ? home : path.posix.join(home, clean.slice(2));
              }
              const normalized = path.posix.normalize(clean);
              const segments = normalized.split('/').filter(Boolean);
              let current = normalized.startsWith('/') ? '/' : '';
              for (const seg of segments) {
                current = current === '/' ? `/${seg}` : current ? `${current}/${seg}` : seg;
                const exists = await new Promise<'dir' | 'file' | 'none'>((resolve) => {
                  sftp.stat(current, (err, st) => {
                    if (err || !st) resolve('none');
                    else resolve((st.mode & 0o170000) === 0o040000 ? 'dir' : 'file');
                  });
                });
                if (exists === 'file') {
                  throw new Error(`Path exists as a file, not a directory: ${current}`);
                }
                if (exists === 'none') {
                  await new Promise<void>((resolve, reject) => {
                    sftp.mkdir(current, (mkErr) => {
                      if (!mkErr) {
                        resolve();
                        return;
                      }
                      sftp.stat(current, (stErr, st) => {
                        if (!stErr && st && (st.mode & 0o170000) === 0o040000) {
                          resolve();
                        } else {
                          reject(mkErr);
                        }
                      });
                    });
                  });
                }
              }
              resolvedDir = await resolveSftpPath(sftp, current || '/');
            } catch (sftpErr) {
              resolvedDir = await resolvePathShell(requestedPath);
              await createDirShell(resolvedDir);
            }

            sendJson(ws, {
              type: 'createDirResult',
              requestId,
              path: resolvedDir,
            });
          } catch (err) {
            sendJson(ws, {
              type: 'createDirError',
              requestId,
              error: err instanceof Error ? err.message : 'Unable to create directory.',
            });
          }
        })();
        return;
      }

      if (msg.type === 'gitCommand') {
        const requestId = typeof msg.requestId === 'string' ? msg.requestId : '';
        const rawCwd = typeof msg.cwd === 'string' ? msg.cwd.trim() : '';
        const action = typeof msg.action === 'string' ? msg.action.trim() : '';
        const payload =
          msg.payload && typeof msg.payload === 'object'
            ? (msg.payload as Record<string, unknown>)
            : {};

        void (async () => {
          try {
            if (!sshClient) {
              throw new Error('SSH is not connected.');
            }
            let cwd = '';
            try {
              const sftp = await getSftp();
              cwd = await resolveSftpPath(sftp, rawCwd || '~');
            } catch {
              cwd = await resolvePathShell(rawCwd || '~');
            }
            const qCwd = quoteShellArg(cwd);

            if (action === 'status') {
              const script = [
                `cd ${qCwd} || exit 1`,
                `if ! command -v git >/dev/null 2>&1; then echo "__GIT_MISSING__"; exit 0; fi`,
                `TOP=$(git rev-parse --show-toplevel 2>/dev/null)`,
                `if [ -z "$TOP" ]; then echo "__NOT_GIT_REPO__"; exit 0; fi`,
                `echo "===NC_TOP==="`,
                `printf '%s\\n' "$TOP"`,
                `echo "===NC_BRANCH==="`,
                `git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || echo "HEAD"`,
                `echo "===NC_AHEAD==="`,
                `git rev-list --left-right --count @{u}...HEAD 2>/dev/null || echo "0 0"`,
                `echo "===NC_REMOTES==="`,
                `git remote 2>/dev/null || true`,
                `echo "===NC_BRANCHES==="`,
                `git branch --format='%(refname:short)|%(HEAD)' 2>/dev/null || true`,
                `echo "===NC_LOG==="`,
                `git log -n 20 --pretty=format:'%H%x1f%h%x1f%s%x1f%an%x1f%ar%x1f%D' 2>/dev/null || true`,
                `echo ""`,
                `echo "===NC_STATUS==="`,
                `git -c core.quotepath=false status --porcelain=v1 -uall 2>/dev/null || true`,
              ].join('\n');

              const { stdout, stderr, code } = await execOnSsh(
                `sh -c ${quoteShellArg(script)}`
              );
              if (code !== 0 && !stdout.includes('===NC_TOP===')) {
                throw new Error(stderr.trim() || 'Unable to inspect git repository.');
              }
              if (stdout.includes('__GIT_MISSING__')) {
                sendJson(ws, {
                  type: 'gitResult',
                  requestId,
                  action,
                  data: {
                    gitInstalled: false,
                    isRepo: false,
                    cwd,
                    repoRoot: null,
                    branch: '',
                    ahead: 0,
                    behind: 0,
                    hasRemote: false,
                    changes: [],
                    branches: [],
                    commits: [],
                  },
                });
                return;
              }
              if (stdout.includes('__NOT_GIT_REPO__')) {
                sendJson(ws, {
                  type: 'gitResult',
                  requestId,
                  action,
                  data: {
                    gitInstalled: true,
                    isRepo: false,
                    cwd,
                    repoRoot: null,
                    branch: '',
                    ahead: 0,
                    behind: 0,
                    hasRemote: false,
                    changes: [],
                    branches: [],
                    commits: [],
                  },
                });
                return;
              }

              const readSection = (tag: string, nextTag?: string): string => {
                const startMarker = `===NC_${tag}===\n`;
                const sIdx = stdout.indexOf(startMarker);
                if (sIdx === -1) return '';
                const from = sIdx + startMarker.length;
                if (!nextTag) return stdout.slice(from);
                const endMarker = `===NC_${nextTag}===`;
                const eIdx = stdout.indexOf(endMarker, from);
                return eIdx === -1 ? stdout.slice(from) : stdout.slice(from, eIdx);
              };

              const repoRoot = readSection('TOP', 'BRANCH').trim() || cwd;
              const branch = readSection('BRANCH', 'AHEAD').trim() || 'HEAD';
              const aheadRaw = readSection('AHEAD', 'REMOTES').trim().split(/\s+/);
              const behind = Number.parseInt(aheadRaw[0] || '0', 10) || 0;
              const ahead = Number.parseInt(aheadRaw[1] || '0', 10) || 0;
              const remotesRaw = readSection('REMOTES', 'BRANCHES').trim();
              const hasRemote = remotesRaw.length > 0;

              const branchesRaw = readSection('BRANCHES', 'LOG').trim();
              const branches = branchesRaw
                ? branchesRaw
                    .split('\n')
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .map((line) => {
                      const [name, headFlag] = line.split('|');
                      return { name: (name || '').trim(), current: headFlag?.trim() === '*' };
                    })
                    .filter((b) => b.name.length > 0)
                : [];

              const logRaw = readSection('LOG', 'STATUS').trim();
              const commits = logRaw
                ? logRaw
                    .split('\n')
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .map((line) => {
                      const [hash, shortHash, subject, author, relativeDate, refs] =
                        line.split('\x1f');
                      return {
                        hash: hash || '',
                        shortHash: shortHash || '',
                        message: subject || '',
                        author: author || '',
                        relativeDate: relativeDate || '',
                        refs: (refs || '').trim(),
                      };
                    })
                    .filter((c) => c.hash.length > 0)
                : [];

              const statusRaw = readSection('STATUS');
              const changes = statusRaw
                .split('\n')
                .filter((line) => line.length >= 4)
                .map((line) => {
                  const indexStatus = line[0] || ' ';
                  const workTreeStatus = line[1] || ' ';
                  let relPath = line.slice(3).trim();
                  if (
                    (relPath.startsWith('"') && relPath.endsWith('"')) ||
                    (relPath.startsWith("'") && relPath.endsWith("'"))
                  ) {
                    relPath = relPath.slice(1, -1);
                  }
                  const arrowIdx = relPath.indexOf(' -> ');
                  if (arrowIdx !== -1) {
                    relPath = relPath.slice(arrowIdx + 4).trim();
                  }
                  const untracked = indexStatus === '?' && workTreeStatus === '?';
                  const staged = !untracked && indexStatus !== ' ';
                  const unstaged = untracked || workTreeStatus !== ' ';
                  return {
                    path: relPath,
                    fullPath: path.posix.join(repoRoot, relPath),
                    indexStatus,
                    workTreeStatus,
                    staged,
                    unstaged,
                    untracked,
                  };
                })
                .filter((item) => item.path.length > 0);

              sendJson(ws, {
                type: 'gitResult',
                requestId,
                action,
                data: {
                  gitInstalled: true,
                  isRepo: true,
                  cwd,
                  repoRoot,
                  branch,
                  ahead,
                  behind,
                  hasRemote,
                  changes,
                  branches,
                  commits,
                },
              });
              return;
            }

            if (action === 'init') {
              const { stdout, stderr, code } = await execOnSsh(
                `cd ${qCwd} && git init`
              );
              if (code !== 0) throw new Error(stderr.trim() || 'git init failed.');
              sendJson(ws, {
                type: 'gitResult',
                requestId,
                action,
                data: { output: stdout.trim() || 'Initialized empty Git repository.' },
              });
              return;
            }

            if (action === 'stage') {
              const rawPaths = Array.isArray(payload.paths)
                ? payload.paths.filter((p): p is string => typeof p === 'string')
                : [];
              const safePaths = rawPaths.filter(isSafeRepoRelativePath);
              const cmd =
                safePaths.length > 0
                  ? `cd ${qCwd} && git add -- ${safePaths.map(quoteShellArg).join(' ')}`
                  : `cd ${qCwd} && git add -A`;
              const { stderr, code } = await execOnSsh(cmd);
              if (code !== 0) throw new Error(stderr.trim() || 'Failed to stage changes.');
              sendJson(ws, { type: 'gitResult', requestId, action, data: { ok: true } });
              return;
            }

            if (action === 'unstage') {
              const rawPaths = Array.isArray(payload.paths)
                ? payload.paths.filter((p): p is string => typeof p === 'string')
                : [];
              const safePaths = rawPaths.filter(isSafeRepoRelativePath);
              const pathArgs =
                safePaths.length > 0 ? ` -- ${safePaths.map(quoteShellArg).join(' ')}` : '';
              const script = [
                `cd ${qCwd} || exit 1`,
                `if git rev-parse --verify HEAD >/dev/null 2>&1; then`,
                `  git reset -q HEAD${pathArgs}`,
                `else`,
                `  git rm --cached -r -q${pathArgs || ' .'}`,
                `fi`,
              ].join('\n');
              const { stderr, code } = await execOnSsh(`sh -c ${quoteShellArg(script)}`);
              if (code !== 0) throw new Error(stderr.trim() || 'Failed to unstage changes.');
              sendJson(ws, { type: 'gitResult', requestId, action, data: { ok: true } });
              return;
            }

            if (action === 'discard') {
              const rawTracked = Array.isArray(payload.trackedPaths)
                ? payload.trackedPaths.filter((p): p is string => typeof p === 'string')
                : [];
              const rawUntracked = Array.isArray(payload.untrackedPaths)
                ? payload.untrackedPaths.filter((p): p is string => typeof p === 'string')
                : [];
              const tracked = rawTracked.filter(isSafeRepoRelativePath);
              const untracked = rawUntracked.filter(isSafeRepoRelativePath);
              if (tracked.length === 0 && untracked.length === 0) {
                throw new Error('No valid files specified to discard.');
              }
              const cmds = [`cd ${qCwd} || exit 1`];
              if (tracked.length > 0) {
                cmds.push(`git checkout -- ${tracked.map(quoteShellArg).join(' ')}`);
              }
              if (untracked.length > 0) {
                cmds.push(`rm -rf -- ${untracked.map(quoteShellArg).join(' ')}`);
              }
              const { stderr, code } = await execOnSsh(
                `sh -c ${quoteShellArg(cmds.join('\n'))}`
              );
              if (code !== 0) throw new Error(stderr.trim() || 'Failed to discard changes.');
              sendJson(ws, { type: 'gitResult', requestId, action, data: { ok: true } });
              return;
            }

            if (action === 'commit') {
              const message = typeof payload.message === 'string' ? payload.message.trim() : '';
              if (!message) throw new Error('Enter a commit message.');
              const stageAll = Boolean(payload.stageAll);
              const cmd = stageAll
                ? `cd ${qCwd} && git add -A && git commit -m ${quoteShellArg(message)}`
                : `cd ${qCwd} && git commit -m ${quoteShellArg(message)}`;
              const { stdout, stderr, code } = await execOnSsh(cmd);
              if (code !== 0) {
                throw new Error(stderr.trim() || stdout.trim() || 'git commit failed.');
              }
              sendJson(ws, {
                type: 'gitResult',
                requestId,
                action,
                data: { output: stdout.trim() },
              });
              return;
            }

            if (action === 'diff') {
              const filePath = typeof payload.path === 'string' ? payload.path.trim() : '';
              const staged = Boolean(payload.staged);
              const untracked = Boolean(payload.untracked);
              if (!filePath || !isSafeRepoRelativePath(filePath)) {
                throw new Error('Invalid repository file path.');
              }
              const qFile = quoteShellArg(filePath);
              if (untracked) {
                const { stdout } = await execOnSsh(
                  `cd ${qCwd} && head -c 262144 ${qFile}`
                );
                sendJson(ws, {
                  type: 'gitResult',
                  requestId,
                  action,
                  data: {
                    path: filePath,
                    staged: false,
                    untracked: true,
                    diffText: '',
                    newFilePreview: stdout,
                  },
                });
                return;
              }
              const diffCmd = staged
                ? `cd ${qCwd} && git diff --cached --no-color -U4 -- ${qFile}`
                : `cd ${qCwd} && git diff --no-color -U4 -- ${qFile}`;
              const { stdout, stderr, code } = await execOnSsh(diffCmd);
              if (code !== 0) throw new Error(stderr.trim() || 'Failed to load diff.');
              sendJson(ws, {
                type: 'gitResult',
                requestId,
                action,
                data: {
                  path: filePath,
                  staged,
                  untracked: false,
                  diffText: stdout,
                },
              });
              return;
            }

            if (action === 'diffSummary') {
              const stagedFlag = Boolean(payload.stagedOnly) ? '--cached ' : '';
              const { stdout } = await execOnSsh(
                `cd ${qCwd} && git diff ${stagedFlag}--no-color --stat && echo "---" && git diff ${stagedFlag}--no-color | head -c 24000`
              );
              sendJson(ws, {
                type: 'gitResult',
                requestId,
                action,
                data: { diffText: stdout },
              });
              return;
            }

            if (action === 'commitDetails') {
              const hash = typeof payload.hash === 'string' ? payload.hash.trim() : '';
              if (!/^[a-fA-F0-9]{4,40}$/.test(hash)) {
                throw new Error('Invalid commit hash.');
              }
              const { stdout, stderr, code } = await execOnSsh(
                `cd ${qCwd} && git show --stat --patch --no-color ${hash} | head -c 160000`
              );
              if (code !== 0) throw new Error(stderr.trim() || 'Unable to inspect commit.');
              sendJson(ws, {
                type: 'gitResult',
                requestId,
                action,
                data: { hash, diffText: stdout },
              });
              return;
            }

            if (action === 'checkout') {
              const rawBranch = typeof payload.branch === 'string' ? payload.branch : '';
              const create = Boolean(payload.create);
              const branch = sanitizeBranchName(rawBranch);
              if (!branch) throw new Error('Enter a valid branch name.');
              const cmd = create
                ? `cd ${qCwd} && git checkout -b ${quoteShellArg(branch)}`
                : `cd ${qCwd} && git checkout ${quoteShellArg(branch)}`;
              const { stdout, stderr, code } = await execOnSsh(cmd);
              if (code !== 0) throw new Error(stderr.trim() || stdout.trim() || 'Checkout failed.');
              sendJson(ws, {
                type: 'gitResult',
                requestId,
                action,
                data: { branch, output: (stderr || stdout).trim() },
              });
              return;
            }

            if (action === 'pull' || action === 'push' || action === 'fetch') {
              let cmd = `cd ${qCwd} && git ${action}`;
              if (action === 'fetch') {
                cmd = `cd ${qCwd} && git fetch --all --prune`;
              } else if (action === 'push') {
                const script = [
                  `cd ${qCwd} || exit 1`,
                  `if git rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1; then`,
                  `  git push`,
                  `else`,
                  `  CUR_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null)`,
                  `  REMOTE_NAME=$(git remote 2>/dev/null | head -n 1)`,
                  `  if [ -n "$CUR_BRANCH" ] && [ -n "$REMOTE_NAME" ]; then`,
                  `    git push -u "$REMOTE_NAME" "$CUR_BRANCH"`,
                  `  else`,
                  `    git push`,
                  `  fi`,
                  `fi`,
                ].join('\n');
                cmd = `sh -c ${quoteShellArg(script)}`;
              }
              const { stdout, stderr, code } = await execOnSsh(cmd, 45000);
              if (code !== 0) {
                throw new Error(stderr.trim() || stdout.trim() || `git ${action} failed.`);
              }
              sendJson(ws, {
                type: 'gitResult',
                requestId,
                action,
                data: { output: (stdout || stderr || `git ${action} completed.`).trim() },
              });
              return;
            }

            throw new Error(`Unsupported git action: ${action || 'unknown'}`);
          } catch (err) {
            sendJson(ws, {
              type: 'gitError',
              requestId,
              action,
              error: err instanceof Error ? err.message : 'Git command failed.',
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
          activeConnectConfig = { ...config };
          activeAuthType = authType;
          activePassword = password;
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
