import type { RemoteDirEntry } from '../components/ProjectTreeView';
import type { PendingDiffHunk } from './codeDiff';

export type CodeAgentTaskMode =
  | 'chat'
  | 'explain'
  | 'fix'
  | 'refactor'
  | 'tests'
  | 'types'
  | 'implement';

export type CodeAgentMode = 'plan' | 'auto';

export type CodeAgentTargetAction =
  | 'none'
  | 'edit-hunks'
  | 'replace-file'
  | 'replace-selection'
  | 'insert-at-cursor'
  | 'create-file';

export interface CodeAgentEditHunk {
  oldCode: string;
  newCode: string;
  description?: string;
}

export interface CodeAgentFileOperation {
  operation: 'edit-file' | 'create-file' | 'create-dir';
  path: string;
  description?: string;
  edits?: CodeAgentEditHunk[];
  content?: string | null;
}

export interface CodeAgentPlanStep {
  title: string;
  description: string;
  action: 'create-dir' | 'create-file' | 'edit-file' | 'verify';
  targetPath?: string;
}

export interface CodeAgentRelatedFile {
  path: string;
  content: string;
}

export interface CodeAgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CodeAgentModelOption {
  id: string;
  label: string;
  description: string;
  provider: 'gemini' | 'groq';
  available: boolean;
}

export interface CodeAgentModelsCatalog {
  defaultModel: string;
  models: CodeAgentModelOption[];
  geminiAvailable: boolean;
  groqAvailable: boolean;
}

export interface CodeAgentRequest {
  prompt: string;
  model?: string;
  taskMode?: CodeAgentTaskMode;
  agentMode?: CodeAgentMode;
  filePath?: string;
  fileName?: string;
  language?: string;
  fileContent?: string;
  selectedCode?: string;
  selectionLineRange?: string;
  cursorLine?: number;
  rootPath?: string;
  projectTree?: string;
  relatedFiles?: CodeAgentRelatedFile[];
  history?: CodeAgentMessage[];
}

export interface CodeAgentResponse {
  reply: string;
  mode: CodeAgentMode;
  plan?: CodeAgentPlanStep[];
  fileOperations?: CodeAgentFileOperation[];
  requestedFiles?: string[];
  edits?: CodeAgentEditHunk[];
  proposedCode: string | null;
  summary: string;
  targetAction: CodeAgentTargetAction;
  suggestedFileName: string | null;
  model: string;
  provider: 'gemini' | 'groq';
}

export interface TrackedFileChange {
  id: string;
  path: string;
  operation: 'edit-file' | 'create-file' | 'create-dir';
  description?: string;
  status: 'pending' | 'accepted' | 'rejected';
  originalContent?: string;
  hunks: PendingDiffHunk[];
  newFileContent?: string;
  unmatchedCount?: number;
  turnId: string;
}

export interface CodeAgentChatTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  taskMode?: CodeAgentTaskMode;
  agentMode?: CodeAgentMode;
  summary?: string;
  plan?: CodeAgentPlanStep[];
  planExecuted?: boolean;
  fileOperations?: CodeAgentFileOperation[];
  edits?: CodeAgentEditHunk[];
  proposedCode?: string | null;
  targetAction?: CodeAgentTargetAction;
  suggestedFileName?: string | null;
  model?: string;
  provider?: 'gemini' | 'groq';
  fileNameHint?: string;
}

export interface CodeAgentHistorySession {
  id: string;
  title: string;
  rootPath: string;
  mode: CodeAgentMode;
  createdAt: number;
  updatedAt: number;
  messages: CodeAgentChatTurn[];
}

const CODE_AGENT_MODEL_KEY = 'notecraft.codeAgentModel.v1';
const CODE_AGENT_MODE_KEY = 'notecraft.codeAgentMode.v1';
const CODE_AGENT_SESSIONS_KEY = 'notecraft.codeAgent.sessions.v1';
const CODE_AGENT_ACTIVE_SESSION_KEY = 'notecraft.codeAgent.activeSession.v1';

export const FALLBACK_CODE_AGENT_MODELS: CodeAgentModelsCatalog = {
  defaultModel: 'gemini-4-hydrogen',
  geminiAvailable: true,
  groqAvailable: false,
  models: [
    {
      id: 'gemini-4-hydrogen',
      label: 'Gemini 4 Hydrogen',
      description: 'Fast coding reasoning, multi-file edits & workspace planning',
      provider: 'gemini',
      available: true,
    },
  ],
};

export function loadSavedCodeAgentModel(fallback = 'gemini-4-hydrogen'): string {
  try {
    const val = window.localStorage.getItem(CODE_AGENT_MODEL_KEY);
    if (val && val.trim()) return val.trim();
  } catch {
    // ignore
  }
  return fallback;
}

export function savePreferredCodeAgentModel(modelId: string): void {
  try {
    const trimmed = modelId.trim();
    if (trimmed) {
      window.localStorage.setItem(CODE_AGENT_MODEL_KEY, trimmed);
    }
  } catch {
    // ignore
  }
}

export function loadPreferredAgentMode(): CodeAgentMode {
  try {
    const val = window.localStorage.getItem(CODE_AGENT_MODE_KEY);
    if (val === 'plan' || val === 'auto') return val;
  } catch {
    // ignore
  }
  return 'auto';
}

export function savePreferredAgentMode(mode: CodeAgentMode): void {
  try {
    window.localStorage.setItem(CODE_AGENT_MODE_KEY, mode);
  } catch {
    // ignore
  }
}

export function loadCodeAgentSessions(): CodeAgentHistorySession[] {
  try {
    const raw = window.localStorage.getItem(CODE_AGENT_SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (s): s is CodeAgentHistorySession =>
          Boolean(s && typeof s === 'object' && typeof s.id === 'string' && Array.isArray(s.messages))
      )
      .slice(0, 30);
  } catch {
    return [];
  }
}

export function saveCodeAgentSessions(sessions: CodeAgentHistorySession[]): void {
  try {
    const trimmed = sessions.slice(0, 30);
    window.localStorage.setItem(CODE_AGENT_SESSIONS_KEY, JSON.stringify(trimmed));
  } catch {
    // ignore quota errors
  }
}

export function loadActiveCodeAgentSessionId(): string | null {
  try {
    return window.localStorage.getItem(CODE_AGENT_ACTIVE_SESSION_KEY);
  } catch {
    return null;
  }
}

export function saveActiveCodeAgentSessionId(sessionId: string | null): void {
  try {
    if (sessionId) {
      window.localStorage.setItem(CODE_AGENT_ACTIVE_SESSION_KEY, sessionId);
    } else {
      window.localStorage.removeItem(CODE_AGENT_ACTIVE_SESSION_KEY);
    }
  } catch {
    // ignore
  }
}

export async function fetchCodeAgentModels(): Promise<CodeAgentModelsCatalog> {
  try {
    const res = await fetch('/api/ai/code-agent/models', {
      method: 'GET',
      credentials: 'same-origin',
    });
    if (!res.ok) return FALLBACK_CODE_AGENT_MODELS;
    const data = (await res.json()) as Partial<CodeAgentModelsCatalog>;
    if (!Array.isArray(data.models) || data.models.length === 0) {
      return FALLBACK_CODE_AGENT_MODELS;
    }
    return {
      defaultModel: data.defaultModel || data.models[0].id,
      models: data.models,
      geminiAvailable: Boolean(data.geminiAvailable),
      groqAvailable: Boolean(data.groqAvailable),
    };
  } catch {
    return FALLBACK_CODE_AGENT_MODELS;
  }
}

export async function requestCodeAgent(payload: CodeAgentRequest): Promise<CodeAgentResponse> {
  const res = await fetch('/api/ai/code-agent', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = (await res.json().catch(() => null)) as
    | (CodeAgentResponse & { error?: string })
    | { error?: string }
    | null;

  if (!res.ok || !data || !('reply' in data)) {
    throw new Error(data?.error || `AI Code Agent request failed (${res.status}).`);
  }

  return data;
}

export function normalizePosixPath(p: string): string {
  const isAbs = p.startsWith('/');
  const parts = p.split('/').filter(Boolean);
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      if (stack.length > 0 && stack[stack.length - 1] !== '..') {
        stack.pop();
      } else if (!isAbs) {
        stack.push('..');
      }
      continue;
    }
    stack.push(part);
  }
  if (isAbs) return `/${stack.join('/')}`;
  return stack.join('/') || '.';
}

export function resolvePosixWorkspacePath(rootPath: string, candidatePath: string): string {
  const trimmed = candidatePath.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('/')) return normalizePosixPath(trimmed);
  if (trimmed === '~' || trimmed.startsWith('~/')) return trimmed;
  const cleanRoot = (rootPath || '/').replace(/\/+$/, '') || '/';
  return normalizePosixPath(cleanRoot === '/' ? `/${trimmed}` : `${cleanRoot}/${trimmed}`);
}

export function buildLoadedProjectTreeSummary(
  rootPath: string,
  dirCache: Record<string, RemoteDirEntry[]>,
  expandedDirs: Record<string, boolean>,
  maxLines = 220
): string {
  const cleanRoot = rootPath.replace(/\/+$/, '') || '/';
  const rootEntries = dirCache[rootPath] ?? dirCache[cleanRoot];
  if (!rootEntries || rootEntries.length === 0) return '';

  const lines: string[] = [`${cleanRoot}/`];
  const visited = new Set<string>([cleanRoot]);

  const walk = (dirPath: string, depth: number) => {
    if (lines.length >= maxLines || depth > 5) return;
    const entries = dirCache[dirPath];
    if (!entries) return;
    const indent = '  '.repeat(depth);

    for (const entry of entries) {
      if (lines.length >= maxLines) {
        lines.push(`${indent}... (more entries omitted)`);
        return;
      }
      if (entry.isDirectory) {
        lines.push(`${indent}${entry.name}/`);
        const fullChild = `${dirPath === '/' ? '' : dirPath}/${entry.name}`;
        if ((expandedDirs[fullChild] || dirCache[fullChild]) && !visited.has(fullChild)) {
          visited.add(fullChild);
          walk(fullChild, depth + 1);
        }
      } else {
        lines.push(`${indent}${entry.name}`);
      }
    }
  };

  walk(dirCache[rootPath] ? rootPath : cleanRoot, 1);
  return lines.join('\n');
}

/**
 * Finds probable related files in the loaded project tree based on relative imports
 * in the active file and filenames mentioned in the user prompt.
 */
export function findCandidateRelatedFiles(
  activeFilePath: string | undefined,
  activeContent: string | undefined,
  prompt: string,
  dirCache: Record<string, RemoteDirEntry[]>,
  maxFiles = 5
): string[] {
  const cachedFiles = new Map<string, string>();
  Object.values(dirCache).forEach((entries) => {
    for (const entry of entries) {
      if (!entry.isDirectory) {
        cachedFiles.set(entry.path, entry.name);
      }
    }
  });
  if (cachedFiles.size === 0) return [];

  const chosen = new Set<string>();
  const addIfKnown = (absPath: string) => {
    if (absPath === activeFilePath) return;
    if (cachedFiles.has(absPath)) {
      chosen.add(absPath);
      return true;
    }
    for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.css', '.json']) {
      if (cachedFiles.has(`${absPath}${ext}`)) {
        chosen.add(`${absPath}${ext}`);
        return true;
      }
    }
    return false;
  };

  // 1. Files explicitly referenced in user prompt
  const promptLower = prompt.toLowerCase();
  for (const [fullPath, name] of cachedFiles.entries()) {
    if (fullPath === activeFilePath) continue;
    if (promptLower.includes(name.toLowerCase()) || promptLower.includes(fullPath.toLowerCase())) {
      chosen.add(fullPath);
      if (chosen.size >= maxFiles) return Array.from(chosen);
    }
  }

  // 2. Relative imports from active file
  if (activeFilePath && activeContent) {
    const parentDir = activeFilePath.split('/').slice(0, -1).join('/') || '/';
    const importRegex = /(?:import|export)\s+(?:[^'"]*from\s+)?['"](\.\.?\/[^'"]+)['"]|require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = importRegex.exec(activeContent)) !== null) {
      const rel = m[1] || m[2];
      if (!rel) continue;
      const resolved = normalizePosixPath(`${parentDir === '/' ? '' : parentDir}/${rel}`);
      addIfKnown(resolved);
      if (chosen.size >= maxFiles) return Array.from(chosen);
    }
  }

  return Array.from(chosen).slice(0, maxFiles);
}
