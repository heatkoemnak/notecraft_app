export type GenerateDocType =
  | 'general'
  | 'spec'
  | 'runbook'
  | 'api'
  | 'meeting'
  | 'guide';

export type GenerateDocLength = 'concise' | 'standard' | 'detailed';

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
}

export interface GenerateDocumentResult {
  title: string;
  content: string;
  summary: string;
  model: string;
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
