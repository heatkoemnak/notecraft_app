import { Folder, NoteDocument } from '../types/notes';

export type GenerateDocType =
  | 'general'
  | 'explain'
  | 'spec'
  | 'runbook'
  | 'api'
  | 'meeting'
  | 'guide';

export type GenerateDocLength = 'concise' | 'standard' | 'detailed';

export type ProjectContextScope = 'none' | 'note' | 'folder' | 'workspace';

export interface ProjectContextNote {
  title: string;
  folderName?: string;
  content: string;
}

export interface GroqModelOption {
  id: string;
  label: string;
  description: string;
  tier: 'production' | 'preview' | 'custom';
  contextWindow?: number;
}

export interface GroqModelsCatalog {
  defaultModel: string;
  models: GroqModelOption[];
  source: 'live' | 'curated';
}

export const AI_MODEL_STORAGE_KEY = 'notecraft.groqModel.v1';

export const FALLBACK_GROQ_MODELS: GroqModelOption[] = [
  {
    id: 'llama-3.3-70b-versatile',
    label: 'Llama 3.3 70B Versatile',
    description: 'Balanced quality and speed for specs, guides, and technical writing',
    tier: 'production',
    contextWindow: 131072,
  },
  {
    id: 'openai/gpt-oss-120b',
    label: 'GPT-OSS 120B',
    description: 'Deep reasoning for complex system architecture and API specifications',
    tier: 'production',
    contextWindow: 131072,
  },
  {
    id: 'openai/gpt-oss-20b',
    label: 'GPT-OSS 20B',
    description: 'Fast reasoning model for runbooks, summaries, and structured notes',
    tier: 'production',
    contextWindow: 131072,
  },
  {
    id: 'llama-3.1-8b-instant',
    label: 'Llama 3.1 8B Instant',
    description: 'Ultra-low latency for quick outlines and concise drafts',
    tier: 'production',
    contextWindow: 131072,
  },
  {
    id: 'qwen/qwen3-32b',
    label: 'Qwen 3 32B',
    description: 'Strong structured writing, tables, and code-heavy documentation',
    tier: 'preview',
    contextWindow: 131072,
  },
  {
    id: 'meta-llama/llama-4-scout-17b-16e-instruct',
    label: 'Llama 4 Scout 17B',
    description: 'Fast Llama 4 drafting for modern technical documentation',
    tier: 'preview',
    contextWindow: 131072,
  },
];

export function loadSavedGroqModel(fallback = 'llama-3.3-70b-versatile'): string {
  try {
    const saved = window.localStorage.getItem(AI_MODEL_STORAGE_KEY);
    if (saved && saved.trim()) return saved.trim();
  } catch {
    // ignore storage errors
  }
  return fallback;
}

export function savePreferredGroqModel(modelId: string): void {
  try {
    const trimmed = modelId.trim();
    if (trimmed) {
      window.localStorage.setItem(AI_MODEL_STORAGE_KEY, trimmed);
    }
  } catch {
    // ignore storage errors
  }
}

export async function fetchGroqModels(): Promise<GroqModelsCatalog> {
  try {
    const res = await fetch('/api/ai/models', {
      method: 'GET',
      credentials: 'same-origin',
    });
    if (!res.ok) {
      return {
        defaultModel: 'llama-3.3-70b-versatile',
        models: FALLBACK_GROQ_MODELS,
        source: 'curated',
      };
    }
    const data = (await res.json()) as Partial<GroqModelsCatalog>;
    if (!Array.isArray(data.models) || data.models.length === 0) {
      return {
        defaultModel: data.defaultModel || 'llama-3.3-70b-versatile',
        models: FALLBACK_GROQ_MODELS,
        source: 'curated',
      };
    }
    return {
      defaultModel: data.defaultModel || data.models[0].id,
      models: data.models,
      source: data.source === 'live' ? 'live' : 'curated',
    };
  } catch {
    return {
      defaultModel: 'llama-3.3-70b-versatile',
      models: FALLBACK_GROQ_MODELS,
      source: 'curated',
    };
  }
}

export interface GenerateDocumentRequest {
  prompt: string;
  model?: string;
  docType: GenerateDocType;
  length: GenerateDocLength;
  includeTables: boolean;
  includeDiagrams: boolean;
  includeCode: boolean;
  existingTitle?: string;
  existingContent?: string;
  projectFolderName?: string;
  projectNotes?: ProjectContextNote[];
}

export interface GenerateDocumentResult {
  title: string;
  content: string;
  summary: string;
  model: string;
}

export function buildProjectContextPayload({
  scope,
  activeNoteId,
  activeTitle,
  activeContent,
  activeFolderId,
  folders,
  allNotes,
}: {
  scope: ProjectContextScope;
  activeNoteId: string;
  activeTitle: string;
  activeContent: string;
  activeFolderId: string | null;
  folders: Folder[];
  allNotes: NoteDocument[];
}): {
  existingTitle?: string;
  existingContent?: string;
  projectFolderName?: string;
  projectNotes?: ProjectContextNote[];
  includedNoteCount: number;
  totalChars: number;
} {
  if (scope === 'none') {
    return { includedNoteCount: 0, totalChars: 0 };
  }

  const folderMap = new Map(folders.map((f) => [f.id, f.name]));
  const activeFolderName = activeFolderId ? folderMap.get(activeFolderId) : undefined;
  const trimmedActive = activeContent.trim();

  if (scope === 'note') {
    return {
      existingTitle: activeTitle,
      existingContent: trimmedActive ? activeContent.slice(0, 26000) : undefined,
      projectFolderName: activeFolderName,
      includedNoteCount: trimmedActive ? 1 : 0,
      totalChars: trimmedActive ? Math.min(activeContent.length, 26000) : 0,
    };
  }

  const candidates = allNotes
    .filter((n) => n.id !== activeNoteId && n.content.trim().length > 0)
    .filter((n) => (scope === 'folder' ? n.folderId === activeFolderId : true))
    .sort((a, b) => {
      // Prioritize notes in the same folder first when using workspace scope
      const aSameFolder = a.folderId === activeFolderId ? 1 : 0;
      const bSameFolder = b.folderId === activeFolderId ? 1 : 0;
      if (aSameFolder !== bSameFolder) return bSameFolder - aSameFolder;
      return b.updatedAt - a.updatedAt;
    });

  const projectNotes: ProjectContextNote[] = [];
  let remainingBudget = 24000;
  let totalChars = trimmedActive ? Math.min(activeContent.length, 26000) : 0;

  for (const item of candidates) {
    if (projectNotes.length >= 16 || remainingBudget < 200) break;
    const clipped = item.content.trim().slice(0, Math.min(8000, remainingBudget));
    if (!clipped) continue;
    remainingBudget -= clipped.length;
    totalChars += clipped.length;
    projectNotes.push({
      title: item.title || 'Untitled Note',
      folderName: item.folderId ? folderMap.get(item.folderId) : 'Unfiled',
      content: clipped,
    });
  }

  return {
    existingTitle: activeTitle,
    existingContent: trimmedActive ? activeContent.slice(0, 26000) : undefined,
    projectFolderName: activeFolderName,
    projectNotes: projectNotes.length > 0 ? projectNotes : undefined,
    includedNoteCount: (trimmedActive ? 1 : 0) + projectNotes.length,
    totalChars,
  };
}

export async function requestAiGenerateDocument(
  payload: GenerateDocumentRequest
): Promise<GenerateDocumentResult> {
  const res = await fetch('/api/ai/generate-document', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = (await res.json().catch(() => null)) as
    | (GenerateDocumentResult & { error?: string })
    | { error?: string }
    | null;

  if (!res.ok || !data || !('content' in data)) {
    throw new Error(
      data?.error || `AI document generation failed (${res.status}).`
    );
  }

  return data;
}
