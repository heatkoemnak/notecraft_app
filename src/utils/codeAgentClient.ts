import type { RemoteDirEntry } from '../components/ProjectTreeView';

export type CodeAgentTaskMode =
  | 'chat'
  | 'explain'
  | 'fix'
  | 'refactor'
  | 'tests'
  | 'types'
  | 'implement';

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
  filePath?: string;
  fileName?: string;
  language?: string;
  fileContent?: string;
  selectedCode?: string;
  selectionLineRange?: string;
  cursorLine?: number;
  rootPath?: string;
  projectTree?: string;
  history?: CodeAgentMessage[];
}

export interface CodeAgentResponse {
  reply: string;
  edits?: CodeAgentEditHunk[];
  proposedCode: string | null;
  summary: string;
  targetAction: CodeAgentTargetAction;
  suggestedFileName: string | null;
  model: string;
  provider: 'gemini' | 'groq';
}

const CODE_AGENT_MODEL_KEY = 'notecraft.codeAgentModel.v1';

export const FALLBACK_CODE_AGENT_MODELS: CodeAgentModelsCatalog = {
  defaultModel: 'gemini-4-hydrogen',
  geminiAvailable: true,
  groqAvailable: false,
  models: [
    {
      id: 'gemini-4-hydrogen',
      label: 'Gemini 4 Hydrogen',
      description: 'Fast coding reasoning, debugging & structured file edits',
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
    // ignore storage failures
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
    // ignore storage failures
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

export function buildLoadedProjectTreeSummary(
  rootPath: string,
  dirCache: Record<string, RemoteDirEntry[]>,
  expandedDirs: Record<string, boolean>,
  maxLines = 180
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
        if (expandedDirs[fullChild] && dirCache[fullChild] && !visited.has(fullChild)) {
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
