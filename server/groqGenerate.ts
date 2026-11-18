import {
  getConfiguredGroqApiKey,
  getDefaultGroqModel,
  sanitizeGroqModelId,
} from './groqModels.ts';
import { GroqProofreadError } from './groqProofread.ts';

export type GenerateDocType =
  | 'general'
  | 'spec'
  | 'runbook'
  | 'api'
  | 'meeting'
  | 'guide';

export type GenerateDocLength = 'concise' | 'standard' | 'detailed';

export interface GenerateDocumentInput {
  prompt: string;
  model?: string;
  docType?: GenerateDocType;
  length?: GenerateDocLength;
  includeTables?: boolean;
  includeDiagrams?: boolean;
  includeCode?: boolean;
  existingTitle?: string;
  existingContent?: string;
}

export interface GenerateDocumentResult {
  title: string;
  content: string;
  summary: string;
  model: string;
}

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 45000;

const DOC_TYPE_GUIDANCE: Record<GenerateDocType, string> = {
  general:
    'Write a clear, well-organized technical note with logical sections, key takeaways, and practical details.',
  spec:
    'Write a complete Technical Specification including Overview, Goals & Non-Goals, Architecture / Design, Data Model or Interfaces, Edge Cases, and Next Steps.',
  runbook:
    'Write an actionable Operational Runbook / SOP including Purpose, Prerequisites, Step-by-Step Procedure, Verification Checks, Troubleshooting, and Rollback Steps.',
  api:
    'Write comprehensive API Documentation including Overview, Authentication, Endpoints (methods, paths, parameters, request/response examples), Error Codes, and Usage Examples.',
  meeting:
    'Write structured Meeting Notes including Context / Agenda, Key Discussion Points, Decisions Made, Risks / Blockers, and Action Items (using - [ ] checklists with owners/next steps).',
  guide:
    'Write a clear Step-by-Step Guide / Tutorial including Introduction, Prerequisites, Numbered Walkthrough Steps, Examples, Best Practices, and Summary.',
};

const LENGTH_GUIDANCE: Record<GenerateDocLength, string> = {
  concise: 'Keep the document focused and concise (roughly 250–450 words).',
  standard: 'Write a thorough, balanced document (roughly 500–900 words).',
  detailed:
    'Write a deep, comprehensive, production-grade document covering edge cases and concrete details (roughly 900–1600 words).',
};

function buildGenerateSystemPrompt(input: GenerateDocumentInput): string {
  const docType = input.docType || 'general';
  const length = input.length || 'standard';

  const extras: string[] = [];
  if (input.includeTables) {
    extras.push(
      'Include well-formatted GitHub-Flavored Markdown tables where structured comparisons, parameters, endpoints, or checklists fit naturally.'
    );
  }
  if (input.includeDiagrams) {
    extras.push(
      'Include at least one clear ```mermaid diagram (such as flowchart TD or sequenceDiagram). Use simple alphanumeric node IDs and double-quoted labels like A["Client"] --> B["Server"] so it parses cleanly.'
    );
  }
  if (input.includeCode) {
    extras.push(
      'Include realistic, accurate fenced code blocks with proper language tags (e.g. ```ts, ```bash, ```json, ```sql).'
    );
  }

  return [
    'You are an expert technical writer and software architect drafting complete, ready-to-use Markdown documents.',
    DOC_TYPE_GUIDANCE[docType],
    LENGTH_GUIDANCE[length],
    ...extras,
    'FORMATTING RULES:',
    '- Return clean GitHub-Flavored Markdown in "content".',
    '- Do NOT start "content" with an `# H1` title heading (put the document title in the JSON "title" field instead, and start "content" with `##` section headings or an intro paragraph).',
    '- Use `##` and `###` headings, bullet lists, numbered lists, task lists (`- [ ]`), inline `code`, and callout blockquotes (`> ...`) cleanly.',
    '- Respond ONLY with a valid JSON object (no surrounding markdown fences) matching this schema:',
    '{"title": string, "content": string, "summary": string}',
    '- "summary" should be a single concise sentence describing what was written.',
  ].join('\n');
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const withoutThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const trimmed = withoutThink || raw.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
    if (fenced) {
      return JSON.parse(fenced[1].trim()) as Record<string, unknown>;
    }
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
    }
    throw new Error('Invalid JSON response from Groq AI');
  }
}

function stripDuplicateLeadingH1(content: string, title: string): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  if (lines.length === 0) return content;
  const firstNonEmptyIdx = lines.findIndex((l) => l.trim().length > 0);
  if (firstNonEmptyIdx < 0) return content;
  const match = /^#\s+(.+)$/.exec(lines[firstNonEmptyIdx].trim());
  if (match && match[1].trim().toLowerCase() === title.trim().toLowerCase()) {
    const rest = lines.slice(firstNonEmptyIdx + 1);
    while (rest.length > 0 && !rest[0].trim()) {
      rest.shift();
    }
    return rest.join('\n');
  }
  return content;
}

async function callGroqGenerate(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  useJsonFormat: boolean
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const body: Record<string, unknown> = {
      model,
      temperature: 0.35,
      max_tokens: 6144,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    };
    if (useJsonFormat) {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      let errMsg = `Groq API error (${res.status})`;
      try {
        const errJson = (await res.json()) as { error?: { message?: string } };
        if (errJson?.error?.message) {
          errMsg = errJson.error.message;
        }
      } catch {
        // ignore parse failure
      }
      throw new GroqProofreadError(errMsg, res.status);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new GroqProofreadError('Groq AI returned an empty response', 502);
    }
    return content;
  } catch (err) {
    if (err instanceof GroqProofreadError) throw err;
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new GroqProofreadError(
        'Groq AI document generation timed out. Try a shorter length or simpler prompt.',
        504
      );
    }
    throw new GroqProofreadError(
      err instanceof Error ? err.message : 'Failed to reach Groq AI service',
      502
    );
  } finally {
    clearTimeout(timeout);
  }
}

function resolveGroqConfig(requestedModel?: string): { apiKey: string; model: string } {
  const apiKey = getConfiguredGroqApiKey();
  if (!apiKey || apiKey === 'MY_GROQ_API_KEY') {
    throw new GroqProofreadError(
      'GROQ_API_KEY is not configured on the server. Add GROQ_API_KEY to your environment secrets or Docker/Portainer stack environment variables and restart the server.',
      503
    );
  }
  const model = sanitizeGroqModelId(requestedModel, getDefaultGroqModel());
  return { apiKey, model };
}

export async function generateDocumentWithGroq(
  input: GenerateDocumentInput
): Promise<GenerateDocumentResult> {
  const { apiKey, model } = resolveGroqConfig(input.model);
  const systemPrompt = buildGenerateSystemPrompt(input);

  const userParts: string[] = [`Write a complete document for the following request:\n${input.prompt.trim()}`];
  if (input.existingContent?.trim()) {
    const clippedContext = input.existingContent.trim().slice(0, 12000);
    userParts.push(
      `Existing note context${input.existingTitle ? ` (Title: "${input.existingTitle.trim()}")` : ''}:\n---\n${clippedContext}\n---\nIncorporate, expand, or restructure relevant details from this existing note as appropriate for the user's request.`
    );
  }
  const userMessage = userParts.join('\n\n');

  let rawResponse: string;
  try {
    rawResponse = await callGroqGenerate(apiKey, model, systemPrompt, userMessage, true);
  } catch (err) {
    if (err instanceof GroqProofreadError && err.status === 400) {
      rawResponse = await callGroqGenerate(apiKey, model, systemPrompt, userMessage, false);
    } else {
      throw err;
    }
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = extractJsonObject(rawResponse);
  } catch {
    throw new GroqProofreadError('Failed to parse Groq AI document response.', 502);
  }

  const title =
    typeof parsed.title === 'string' && parsed.title.trim()
      ? parsed.title.trim()
      : input.existingTitle?.trim() || 'Generated Document';

  const rawContent = typeof parsed.content === 'string' ? parsed.content.trim() : '';
  if (!rawContent) {
    throw new GroqProofreadError('Groq AI generated an empty document body.', 502);
  }

  const content = stripDuplicateLeadingH1(rawContent, title);
  const summary =
    typeof parsed.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim()
      : `Drafted "${title}" with Groq AI.`;

  return {
    title,
    content,
    summary,
    model,
  };
}
