export interface GroqModelOption {
  id: string;
  label: string;
  description: string;
  tier: 'production' | 'preview' | 'custom';
  contextWindow?: number;
}

export const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';

export const CURATED_GROQ_MODELS: GroqModelOption[] = [
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

const NON_TEXT_MODEL_PATTERN =
  /whisper|tts|playai|orpheus|guard|safeguard|moderation|prompt-guard|distil-whisper/i;

export function getConfiguredGroqApiKey(): string {
  const rawKey = process.env.GROQ_API_KEY ?? process.env.GROQ_KEY ?? '';
  return rawKey.trim().replace(/^['"]|['"]$/g, '').trim();
}

export function getDefaultGroqModel(): string {
  const rawModel = process.env.GROQ_MODEL ?? '';
  const cleaned = rawModel.trim().replace(/^['"]|['"]$/g, '').trim();
  return cleaned || DEFAULT_GROQ_MODEL;
}

export function sanitizeGroqModelId(candidate: unknown, fallback?: string): string {
  if (typeof candidate === 'string') {
    const cleaned = candidate.trim().replace(/^['"]|['"]$/g, '').trim();
    if (/^[a-zA-Z0-9._:/-]{2,120}$/.test(cleaned)) {
      return cleaned;
    }
  }
  return fallback || getDefaultGroqModel();
}

function formatDynamicModelLabel(id: string): string {
  const short = id.includes('/') ? id.split('/').slice(1).join('/') : id;
  return short
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => {
      if (/^\d+[bmk]?$/i.test(part)) return part.toUpperCase();
      if (part.toLowerCase() === 'gpt' || part.toLowerCase() === 'oss') {
        return part.toUpperCase();
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

export async function listAvailableGroqModels(): Promise<{
  defaultModel: string;
  models: GroqModelOption[];
  source: 'live' | 'curated';
}> {
  const defaultModel = getDefaultGroqModel();
  const apiKey = getConfiguredGroqApiKey();

  const ensureDefaultPresent = (list: GroqModelOption[]): GroqModelOption[] => {
    if (list.some((m) => m.id === defaultModel)) return list;
    return [
      {
        id: defaultModel,
        label: formatDynamicModelLabel(defaultModel),
        description: 'Configured server default model',
        tier: 'custom',
      },
      ...list,
    ];
  };

  if (!apiKey || apiKey === 'MY_GROQ_API_KEY') {
    return {
      defaultModel,
      models: ensureDefaultPresent([...CURATED_GROQ_MODELS]),
      source: 'curated',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        defaultModel,
        models: ensureDefaultPresent([...CURATED_GROQ_MODELS]),
        source: 'curated',
      };
    }

    const payload = (await res.json()) as {
      data?: Array<{
        id?: string;
        active?: boolean;
        context_window?: number;
        owned_by?: string;
      }>;
    };

    const rawModels = Array.isArray(payload.data) ? payload.data : [];
    const liveIds = new Set<string>();
    const liveMap = new Map<string, { contextWindow?: number; ownedBy?: string }>();

    for (const item of rawModels) {
      if (!item?.id || item.active === false) continue;
      if (NON_TEXT_MODEL_PATTERN.test(item.id)) continue;
      liveIds.add(item.id);
      liveMap.set(item.id, {
        contextWindow: typeof item.context_window === 'number' ? item.context_window : undefined,
        ownedBy: typeof item.owned_by === 'string' ? item.owned_by : undefined,
      });
    }

    if (liveIds.size === 0) {
      return {
        defaultModel,
        models: ensureDefaultPresent([...CURATED_GROQ_MODELS]),
        source: 'curated',
      };
    }

    // Preserve curated order for known active models, then append other active live text models
    const merged: GroqModelOption[] = [];
    for (const curated of CURATED_GROQ_MODELS) {
      if (liveIds.has(curated.id)) {
        const meta = liveMap.get(curated.id);
        merged.push({
          ...curated,
          contextWindow: meta?.contextWindow ?? curated.contextWindow,
        });
        liveIds.delete(curated.id);
      }
    }

    const remaining = Array.from(liveIds)
      .sort((a, b) => a.localeCompare(b))
      .map((id): GroqModelOption => {
        const meta = liveMap.get(id);
        return {
          id,
          label: formatDynamicModelLabel(id),
          description: meta?.ownedBy
            ? `Available on Groq (${meta.ownedBy})`
            : 'Available on Groq API',
          tier: 'preview',
          contextWindow: meta?.contextWindow,
        };
      });

    return {
      defaultModel,
      models: ensureDefaultPresent([...merged, ...remaining]),
      source: 'live',
    };
  } catch {
    return {
      defaultModel,
      models: ensureDefaultPresent([...CURATED_GROQ_MODELS]),
      source: 'curated',
    };
  } finally {
    clearTimeout(timeout);
  }
}
